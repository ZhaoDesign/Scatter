import React from 'react';
import type { CanvasGroupLayout } from '../../../shared/types';

export interface CanvasGroupLayoutControlsProps {
  /** 当前布局参数（受控） */
  layout: CanvasGroupLayout;
  /** 布局参数变更时回调，仅携带发生变化的字段 */
  onChange: (patch: Partial<CanvasGroupLayout>) => void;
}

type PaddingSide = keyof CanvasGroupLayout['padding']; // 'top' | 'right' | 'bottom' | 'left'

const AXIS_OPTIONS: { value: CanvasGroupLayout['axis']; label: string }[] = [
  { value: 'horizontal', label: '横向' },
  { value: 'vertical', label: '纵向' },
];

const ALIGNMENT_OPTIONS: { value: CanvasGroupLayout['alignment']; label: string }[] = [
  { value: 'start', label: '前对齐' },
  { value: 'center', label: '居中' },
  { value: 'end', label: '后对齐' },
];

const PADDING_FIELDS: { key: PaddingSide; label: string; min: number; max: number }[] = [
  { key: 'top', label: '上', min: 0, max: 1200 },
  { key: 'right', label: '右', min: 0, max: 1200 },
  { key: 'bottom', label: '下', min: 0, max: 1200 },
  { key: 'left', label: '左', min: 0, max: 1200 },
];

const GAP_MIN = 0;
const GAP_MAX = 800;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 画布组布局参数编辑控件。
 * 仅负责纯参数编辑：不接 store / canvas、不触发重排、无副作用。
 * 所有 hooks（如有）均位于任何条件 return 之前。
 */
export function CanvasGroupLayoutControls({
  layout,
  onChange,
}: CanvasGroupLayoutControlsProps) {
  const handleNumber = (field: 'gap' | PaddingSide, value: number) => {
    if (field === 'gap') {
      onChange({ gap: clampInt(value, GAP_MIN, GAP_MAX) });
      return;
    }
    // 单边 padding：复制整个 padding 对象，只更新该边；绝不修改/清空 childOrder。
    onChange({
      padding: { ...layout.padding, [field]: clampInt(value, 0, 1200) },
    });
  };

  const onRawNumber = (field: 'gap' | PaddingSide, raw: string) => {
    // 空串：写回当前值，保证受控输入不卡死，也不产生非法 patch。
    if (raw.trim() === '') {
      handleNumber(field, field === 'gap' ? layout.gap : layout.padding[field]);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    handleNumber(field, n);
  };

  const setAxis = (axis: CanvasGroupLayout['axis']) => onChange({ axis });

  const setAlignment = (alignment: CanvasGroupLayout['alignment']) =>
    onChange({ alignment });

  return (
    <div
      className="canvas-group-layout-controls"
      role="group"
      aria-label="画布组布局设置"
      style={base.container}
    >
      {/* 方向（axis） */}
      <div style={base.row}>
        <span style={base.rowLabel}>方向</span>
        <div role="group" aria-label="方向切换" style={base.segGroup}>
          {AXIS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={layout.axis === opt.value}
              onClick={() => setAxis(opt.value)}
              style={seg(opt.value === layout.axis)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 主轴间距（gap） */}
      <label style={base.row} htmlFor="cgl-gap">
        <span style={base.rowLabel}>主轴间距</span>
        <input
          id="cgl-gap"
          type="number"
          inputMode="numeric"
          min={GAP_MIN}
          max={GAP_MAX}
          step={1}
          value={layout.gap}
          onChange={(e) => onRawNumber('gap', e.target.value)}
          style={base.numInput}
        />
      </label>

      {/* 四边内边距（padding） */}
      <div style={base.padGrid}>
        {PADDING_FIELDS.map((f) => (
          <label key={f.key} style={base.padCell} htmlFor={`cgl-pad-${f.key}`}>
            <span style={base.padLabel}>{f.label}</span>
            <input
              id={`cgl-pad-${f.key}`}
              type="number"
              inputMode="numeric"
              min={f.min}
              max={f.max}
              step={1}
              value={layout.padding[f.key]}
              onChange={(e) => onRawNumber(f.key, e.target.value)}
              style={base.numInput}
            />
          </label>
        ))}
      </div>

      {/* 对齐（alignment） */}
      <div style={base.row}>
        <span style={base.rowLabel}>对齐</span>
        <div role="group" aria-label="对齐方式" style={base.segGroup}>
          {ALIGNMENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={layout.alignment === opt.value}
              onClick={() => setAlignment(opt.value)}
              style={seg(opt.value === layout.alignment)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CanvasGroupLayoutControls;

function seg(active: boolean): React.CSSProperties {
  return active ? base.segButtonActive : base.segButton;
}

/** 局部内联样式：复用项目 CSS token，不引入 / 修改任何 CSS 文件。 */
const base: { [k: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    boxSizing: 'border-box',
    userSelect: 'none',
    color: 'var(--color-text)',
    background: 'var(--color-background-surface)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    fontSize: 13,
    color: 'var(--color-text-subtle)',
    whiteSpace: 'nowrap',
  },
  segGroup: {
    display: 'flex',
    gap: 4,
  },
  segButton: {
    padding: '4px 10px',
    fontSize: 13,
    lineHeight: 1,
    color: 'var(--color-text-subtle)',
    background: 'var(--color-background-input)',
    border: '1px solid var(--color-border-divider)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  segButtonActive: {
    color: 'var(--color-primary-subtle)',
    background: 'var(--color-primary)',
    borderColor: 'var(--color-primary)',
  },
  numInput: {
    width: 72,
    padding: '4px 6px',
    fontSize: 13,
    color: 'var(--color-text)',
    background: 'var(--color-background-input)',
    border: '1px solid var(--color-border-divider)',
    borderRadius: 6,
    textAlign: 'right',
  },
  padGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  padCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  padLabel: {
    fontSize: 12,
    color: 'var(--color-text-subtle)',
  },
};