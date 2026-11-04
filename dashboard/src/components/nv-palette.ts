/* Command palette ⌘K. */
import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { toast } from './nv-toast';
import { openModal } from './nv-modal';
import {
  getClient, theme, expectedWitness, witnessHex, witnessVerified, pushLog, running,
} from '../store/appStore';

interface Cmd { ico: string; label: string; kbd?: string; run: () => void; }

@customElement('nv-palette')
export class NvPalette extends LitElement {
  @state() private open = false;
  @state() private filter = '';
  @state() private idx = 0;
  @query('#palette-input') private inputEl!: HTMLInputElement;

  static styles = css`
    :host {
      position: fixed; inset: 0; z-index: 220;
      background: rgba(0,0,0,0.5);
      opacity: 0; pointer-events: none;
      transition: opacity 0.15s;
      display: flex; justify-content: center; padding-top: 12vh;
      backdrop-filter: blur(4px);
    }
    :host([open]) { opacity: 1; pointer-events: auto; }
    .palette {
      width: min(560px, 92vw);
      background: var(--bg-1);
      border: 1px solid var(--line-2);
      border-radius: var(--radius);
      box-shadow: 0 30px 80px -20px rgba(0,0,0,0.7);
      overflow: hidden;
      display: flex; flex-direction: column;
      max-height: 60vh;
    }
    .input {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    input {
      width: 100%;
      background: transparent; border: none; outline: none;
      color: var(--ink); font-size: 14px;
      font-family: inherit;
    }
    .list { flex: 1; overflow-y: auto; padding: 4px; }
    .item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
    }
    .item.active { background: var(--bg-3); }
    .item .ico { width: 20px; text-align: center; color: var(--accent); }
    .item .lbl { flex: 1; }
    .item .kbd {
      font-family: var(--mono); font-size: 10.5px;
      color: var(--ink-3);
      padding: 1px 5px; background: var(--bg-3); border-radius: 4px;
    }
  `;

  private cmds: Cmd[] = [
    { ico: '▶', label: '运行流水线', kbd: 'Space', run: async () => { await getClient()?.run(); running.value = true; toast('流水线运行中', '▶'); } },
    { ico: '❚', label: '暂停流水线', run: async () => { await getClient()?.pause(); running.value = false; toast('已暂停', '❚❚'); } },
    { ico: '+', label: '新建场景…', kbd: '⌘N', run: () => openModal({
      title: '新建场景',
      body: `<p>构建一个新的磁场场景。仪表盘会生成 JSON 并推送到运行中的流水线
        （你也可以复制该 JSON 供离线使用）。</p>
        <label>名称</label>
        <input type="text" id="ns-name" value="custom-scene-${Date.now().toString(36)}" />
        <label>心脏等效偶极矩（A·m²）</label>
        <input type="text" id="ns-moment" value="1.0e-6" />
        <label>心脏到传感器的距离（m）</label>
        <input type="text" id="ns-distance" value="0.5" />
        <label>在 +x = 1 m 处添加铁磁干扰物？</label>
        <select id="ns-ferrous">
          <option value="0">否</option>
          <option value="1" selected>是（钢线圈，χ=5000）</option>
        </select>
        <label>添加 60 Hz 市电电流环？</label>
        <select id="ns-mains">
          <option value="0">否</option>
          <option value="1" selected>是（2 A 环，半径 5 cm，+y = 1 m）</option>
        </select>`,
      buttons: [
        { label: '取消', variant: 'ghost' },
        { label: '创建', variant: 'primary', onClick: async () => {
          const root = document.querySelector('nv-app')?.shadowRoot?.querySelector('nv-modal')?.shadowRoot;
          if (!root) return;
          const name = (root.querySelector<HTMLInputElement>('#ns-name')?.value ?? 'custom').trim();
          const m = parseFloat(root.querySelector<HTMLInputElement>('#ns-moment')?.value ?? '1e-6');
          const d = parseFloat(root.querySelector<HTMLInputElement>('#ns-distance')?.value ?? '0.5');
          const ferr = root.querySelector<HTMLSelectElement>('#ns-ferrous')?.value === '1';
          const mains = root.querySelector<HTMLSelectElement>('#ns-mains')?.value === '1';
          const scene = {
            dipoles: [{ position: [0, 0, d] as [number, number, number], moment: [0, 0, m] as [number, number, number] }],
            loops: mains ? [{
              centre: [0, 1, 0] as [number, number, number],
              normal: [0, 1, 0] as [number, number, number],
              radius: 0.05, current: 2.0, n_segments: 64,
            }] : [],
            ferrous: ferr ? [{ position: [1, 0, 0] as [number, number, number], volume: 1e-4, susceptibility: 5000 }] : [],
            eddy: [],
            sensors: [[0, 0, 0] as [number, number, number]],
            ambient_field: [1e-6, 0, 0] as [number, number, number],
          };
          await getClient()?.loadScene(scene);
          pushLog('ok', `场景 <span class="s">${name}</span> 已加载 · 1 个偶极子 · ${mains ? '1 loop · ' : ''}${ferr ? '1 ferrous · ' : ''}1 sensor`);
          toast(`场景「${name}」已加载`, '+');
        } },
      ],
    }) },
    { ico: '📦', label: '导出证明包…', kbd: '⌘E', run: async () => {
      const c = getClient(); if (!c) return;
      pushLog('dbg', '正在构建证明包…');
      try {
        const blob = await c.exportProofBundle();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nvsim-proof-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        pushLog('ok', `证明包已导出 · ${blob.size} 字节`);
        toast(`证明包已保存（${blob.size} B）`, '📦');
      } catch (e) { pushLog('err', `导出失败：${(e as Error).message}`); }
    } },
    { ico: '⟳', label: '重置流水线', kbd: '⌘R', run: () => openModal({
      title: '重置流水线？',
      body: '<p>清空帧流并将 <code>t</code> 回退到 0。</p>',
      buttons: [
        { label: '取消', variant: 'ghost' },
        { label: '重置', variant: 'danger', onClick: async () => { await getClient()?.reset(); pushLog('warn', '流水线已重置 · t=0'); toast('流水线已重置', '⟳'); } },
      ],
    }) },
    { ico: '✓', label: '校验见证', run: async () => {
      const c = getClient(); if (!c) return;
      witnessVerified.value = 'pending';
      const exp = expectedWitness.value;
      const eb = new Uint8Array(32);
      for (let i = 0; i < 32; i++) eb[i] = parseInt(exp.slice(i * 2, i * 2 + 2), 16);
      const r = await c.verifyWitness(eb);
      if (r.ok) { witnessVerified.value = 'ok'; witnessHex.value = exp; toast('见证校验通过', '✓'); }
      else { witnessVerified.value = 'fail'; toast('见证不匹配！', '✗'); }
    } },
    { ico: '☼', label: '切换主题', kbd: '⌘/', run: () => { theme.value = theme.value === 'dark' ? 'light' : 'dark'; } },
    { ico: '⚙', label: '打开设置', kbd: '⌘,', run: () => window.dispatchEvent(new CustomEvent('open-settings')) },
    { ico: '?', label: '键盘快捷键…', run: () => openModal({
      title: '键盘快捷键',
      body: `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;">
        <div><code>⌘K / Ctrl K</code></div><div>命令面板</div>
        <div><code>Space</code></div><div>播放 / 暂停</div>
        <div><code>⌘R</code></div><div>重置</div>
        <div><code>⌘,</code></div><div>设置</div>
        <div><code>⌘/</code></div><div>切换主题</div>
        <div><code>\`</code></div><div>调试 HUD</div>
        <div><code>1 · 2 · 3</code></div><div>检查器标签页</div>
        <div><code>Esc</code></div><div>关闭弹窗 / 面板</div>
        <div><code>/</code></div><div>聚焦 REPL</div>
      </div>`,
      buttons: [{ label: '关闭', variant: 'primary' }],
    }) },
    { ico: 'i', label: '关于 nvsim…', run: () => openModal({
      title: '关于 nvsim',
      body: `<p><b>nvsim</b> 是面向氮-空位（NV）色心金刚石磁测量的确定性、字节可复现前向模拟器。</p>
        <p>本仪表盘以 WASM 形式在 Web Worker 中运行 nvsim。相同的 <code>(scene, config, seed)</code> 在不同运行与不同机器上产生字节完全一致的 SHA-256 见证。</p>
        <p>许可证：MIT OR Apache-2.0 · 参见 ADR-089、ADR-092。</p>`,
      buttons: [{ label: '关闭', variant: 'primary' }],
    }) },
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('nv-palette', this.onOpen as EventListener);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('nv-palette', this.onOpen as EventListener);
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openPal();
    } else if (e.key === 'Escape' && this.open) {
      this.closePal();
    } else if (this.open) {
      if (e.key === 'ArrowDown') { this.idx = Math.min(this.cmds.length - 1, this.idx + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.idx = Math.max(0, this.idx - 1); e.preventDefault(); }
      else if (e.key === 'Enter') { this.runIdx(); e.preventDefault(); }
    }
  };

  private onOpen = (): void => this.openPal();

  private openPal(): void {
    this.open = true; this.setAttribute('open', '');
    this.filter = ''; this.idx = 0;
    setTimeout(() => this.inputEl?.focus(), 0);
  }
  private closePal(): void { this.open = false; this.removeAttribute('open'); }

  private filtered(): Cmd[] {
    if (!this.filter.trim()) return this.cmds;
    const q = this.filter.toLowerCase();
    return this.cmds.filter((c) => c.label.toLowerCase().includes(q));
  }

  private runIdx(): void {
    const f = this.filtered();
    const c = f[this.idx];
    if (c) { c.run(); this.closePal(); }
  }

  override render() {
    const items = this.filtered();
    return html`
      <div class="palette" data-id="palette">
        <div class="input">
          <input id="palette-input" type="text" placeholder="输入命令…"
            .value=${this.filter}
            @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; this.idx = 0; }} />
        </div>
        <div class="list">
          ${items.map((c, i) => html`
            <div class="item ${i === this.idx ? 'active' : ''}" @click=${() => { this.idx = i; this.runIdx(); }}>
              <span class="ico">${c.ico}</span>
              <span class="lbl">${c.label}</span>
              ${c.kbd ? html`<span class="kbd">${c.kbd}</span>` : ''}
            </div>
          `)}
        </div>
      </div>
    `;
  }
}
