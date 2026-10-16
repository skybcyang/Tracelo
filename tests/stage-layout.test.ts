import { describe, it, expect } from 'vitest';
import { defaultStageLayout, normalizeStageLayout, insertStageModule, removeStageModule, resizeStagePair } from '../src/stage-layout';
import { normalizePluginState } from '../src/archive';
describe('task-local stage layout', () => {
 it('has an equal default, with an optional directory column', () => {
  expect(defaultStageLayout(false).columns.map(c=>c.rows.map(r=>r.module))).toEqual([['progress'],['todos','details']]);
  expect(defaultStageLayout(true).columns).toHaveLength(3);
 });
 it('moves a unique module, balances inserted columns and only the target rows', () => {
  const base=defaultStageLayout(false); base.columns[0].width=.7; base.columns[1].width=.3;
  const moved=insertStageModule(base,'details',0,1,false);
  expect(moved.columns[0].rows.map(r=>r.module)).toEqual(['progress','details']);
  expect(moved.columns[0].rows.map(r=>r.height)).toEqual([.5,.5]);
  expect(moved.columns.map(c=>c.width)).toEqual([.7,.3]);
  const added=insertStageModule(moved,'files',1,0,true);
  expect(added.columns.map(c=>c.width)).toEqual([1/3,1/3,1/3]);
  expect(base.columns[1].rows).toHaveLength(2);
 });
 it('allows an empty stage without deleting content, clamps resize, and rejects corrupt saved structures', () => {
  const one=removeStageModule(removeStageModule(defaultStageLayout(false),'todos'),'details');
  expect(removeStageModule(one,'progress')).toEqual({columns:[]});
  expect(normalizeStageLayout({columns:[]})).toEqual({columns:[]});
  const resized=resizeStagePair(defaultStageLayout(false),0,null,.99);
  expect(resized.columns[0].width).toBeLessThanOrEqual(.85);
  expect(resized.columns[0].width+resized.columns[1].width).toBeCloseTo(1);
  expect(normalizeStageLayout({columns:[{width:1,rows:[{module:'evil',height:1}]}]})).toBeNull();
  expect(normalizeStageLayout({columns:[{width:1,rows:[{module:'progress',height:1},{module:'progress',height:1}]}]})).toBeNull();
 });
 it('uses the original row boundary when moving within the same column', () => {
  const base=defaultStageLayout(false);
  expect(insertStageModule(base,'todos',1,1,false)).toEqual(base);
  expect(insertStageModule(base,'todos',1,0,false)).toEqual(base);
  expect(insertStageModule(base,'details',1,0,false).columns[1].rows.map(r=>r.module)).toEqual(['details','todos']);
  expect(insertStageModule(base,'todos',1,2,false).columns[1].rows.map(r=>r.module)).toEqual(['details','todos']);
 });
 it('persists by directory and stable task identity without changing formal tasks', () => {
  const value=normalizePluginState({stageLayouts:{'folder/task-id':defaultStageLayout(true)},background:{preset:'custom',image:'data:image/png;base64,YQ==',brightness:95,blur:8}});
  expect(value.stageLayouts['folder/task-id'].columns).toHaveLength(3);
  expect(value.background.image).toBe('data:image/png;base64,YQ==');
  expect(normalizePluginState(value)).toEqual(value);
  expect(normalizePluginState({background:{preset:'bad',image:'javascript:alert(1)',brightness:999,blur:-5}}).background).toEqual({preset:'abstract',image:'',brightness:130,blur:0});
 });
});
