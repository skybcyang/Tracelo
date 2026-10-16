/** View preferences only. Never serialized into the task's formal Markdown/history. */
export const STAGE_MODULES = ['progress', 'todos', 'details', 'files'] as const;
export type StageModule = typeof STAGE_MODULES[number];
export interface StageRow { module: StageModule; height: number }
export interface StageColumn { width: number; rows: StageRow[] }
export interface StageLayout { columns: StageColumn[] }
export interface WorkbenchBackground { preset: 'abstract' | 'mountains' | 'architecture' | 'custom'; image: string; brightness: number; blur: number }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const equal = (n: number) => Array(n).fill(1 / n) as number[];
const ratios = (values: number[]) => { const sum = values.reduce((a,b)=>a+b,0); return values.map(v=>v/sum); };
export function defaultStageLayout(files: boolean): StageLayout {
 const groups: StageModule[][] = [['progress'], ['todos','details'], ...(files ? [['files'] as StageModule[]] : [])];
 return {columns: groups.map(rows=>({width:1/groups.length, rows:rows.map(module=>({module,height:1/rows.length}))}))};
}
export function normalizeStageLayout(value: unknown): StageLayout | null {
 if (!record(value) || !Array.isArray(value.columns) || value.columns.length>4) return null;
 const seen=new Set<string>(), columns:StageColumn[]=[];
 for (const c of value.columns) {
  if (!record(c) || typeof c.width!=='number' || !Number.isFinite(c.width) || c.width<=0 || !Array.isArray(c.rows) || !c.rows.length || c.rows.length>4) return null;
  const rows:StageRow[]=[];
  for (const r of c.rows) {
   if (!record(r) || !STAGE_MODULES.includes(r.module as StageModule) || seen.has(r.module as string) || typeof r.height!=='number' || !Number.isFinite(r.height) || r.height<=0) return null;
   seen.add(r.module as string); rows.push({module:r.module as StageModule,height:r.height});
  }
  const heights=ratios(rows.map(r=>r.height)); rows.forEach((r,i)=>r.height=heights[i]); columns.push({width:c.width,rows});
 }
 const widths=ratios(columns.map(c=>c.width)); columns.forEach((c,i)=>c.width=widths[i]);
 return {columns};
}
export function normalizeStageLayouts(value: unknown): Record<string,StageLayout> {
 if (!record(value)) return {};
 return Object.fromEntries(Object.entries(value).flatMap(([k,v])=> { const layout=normalizeStageLayout(v); return layout?[[k,layout]]:[]; }));
}
export function normalizeBackground(value:unknown): WorkbenchBackground {
 const v=record(value)?value:{};
 const image=typeof v.image==='string' && v.image.length<12*1024*1024 && /^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(v.image)?v.image:'';
 const preset=['abstract','mountains','architecture','custom'].includes(v.preset as string)?v.preset as WorkbenchBackground['preset']:'abstract';
 return {preset:preset==='custom'&&!image?'abstract':preset,image,
 brightness:typeof v.brightness==='number'&&Number.isFinite(v.brightness)?Math.max(55,Math.min(130,v.brightness)):100,
 blur:typeof v.blur==='number'&&Number.isFinite(v.blur)?Math.max(0,Math.min(24,v.blur)):4};
}
export function insertStageModule(layout: StageLayout, module: StageModule, column: number, row: number, newColumn: boolean): StageLayout {
 const next=structuredClone(layout);
 // Retain the target column's identity while removing the module from its old location.
 const target=next.columns[column];
 const oldRow=target?.rows.findIndex(r=>r.module===module)??-1;
 if(!newColumn&&oldRow>=0&&(row===oldRow||row===oldRow+1))return next;
 for (const c of next.columns) c.rows=c.rows.filter(r=>r.module!==module);
 if (newColumn) next.columns.splice(column,0,{width:1,rows:[{module,height:1}]});
 else if (target) {target.rows.splice(row-(oldRow>=0&&oldRow<row?1:0),0,{module,height:1}); target.rows.forEach(r=>r.height=1/target.rows.length);}
 else return layout;
 next.columns=next.columns.filter(c=>c.rows.length);
 next.columns.forEach(c=> {const hs=ratios(c.rows.map(r=>r.height)); c.rows.forEach((r,i)=>r.height=hs[i]);});
 const widths=newColumn?equal(next.columns.length):ratios(next.columns.map(c=>c.width));
 next.columns.forEach((c,i)=>c.width=widths[i]); return next;
}
export function removeStageModule(layout: StageLayout, module: StageModule): StageLayout {
 const next=structuredClone(layout); next.columns.forEach(c=>c.rows=c.rows.filter(r=>r.module!==module)); next.columns=next.columns.filter(c=>c.rows.length);
 next.columns.forEach(c=>c.rows.forEach(r=>r.height=1/c.rows.length));
 next.columns.forEach(c=>c.width=1/next.columns.length); return next;
}
export function resizeStagePair(layout:StageLayout,column:number,row:number|null,delta:number):StageLayout {
 const next=structuredClone(layout);
 const entries=row===null?next.columns:next.columns[column]?.rows;
 if(!entries)return next;
 const index=row??column, a=entries[index],b=entries[index+1]; if(!a||!b)return next;
 const key=row===null?'width':'height';
 const values=entries as unknown as Record<string,number>[];
 const total=values[index][key]+values[index+1][key], min=total*.15;
 const value=Math.max(min,Math.min(total-min,values[index][key]+delta));
 values[index][key]=value;values[index+1][key]=total-value; return next;
}
