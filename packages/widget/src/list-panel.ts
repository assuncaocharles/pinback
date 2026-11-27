import { normalisePath, type Thread } from '@assuncaocharles/pinback-core';
import { h } from './dom.js';

export interface ListModel {
  threads: readonly Thread[];
  pathname: string;
  isAnchored(id: string): boolean;
}

export interface ListCallbacks {
  onSelect(thread: Thread, outdated: boolean): void;
}

function excerpt(t: Thread): string {
  return t.root.text.replace(/<sub>[\s\S]*?<\/sub>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || '(no text)';
}

/** The comment list: a disclosure panel above the toolbar, grouped by where each thread can be shown. */
export function renderList(model: ListModel, cb: ListCallbacks): DocumentFragment {
  const here = normalisePath(model.pathname);
  const open = model.threads.filter((t) => t.state === 'open');
  const onPage = open.filter((t) => normalisePath(t.root.meta.url) === here);
  const anchored = onPage.filter((t) => model.isAnchored(t.id));
  const outdated = onPage.filter((t) => !model.isAnchored(t.id));
  const elsewhere = open.filter((t) => normalisePath(t.root.meta.url) !== here);
  const resolved = model.threads.filter((t) => t.state === 'resolved');

  const item = (t: Thread, note: string | null, action: () => void) => {
    const btn = h(
      'button',
      { type: 'button', class: 'item' },
      h('span', { class: 'sr-only' }, 'Comment '),
      h('span', { class: 'num' }, String(t.number)),
      h('span', { class: 'text' }, h('span', { class: 'excerpt' }, excerpt(t)), ' ', h('span', { class: 'muted' }, `${t.root.author.login}${note ? ` · ${note}` : ''}`)),
    );
    btn.addEventListener('click', action);
    return h('li', {}, btn);
  };

  const group = (title: string, items: HTMLLIElement[], hint?: string) =>
    items.length
      ? h('section', {}, h('h3', {}, title), hint ? h('p', { class: 'hint' }, hint) : null, h('ul', {}, ...items))
      : null;

  const frag = document.createDocumentFragment();
  frag.append(h('h2', { class: 'sr-only' }, 'Comments'));
  if (!model.threads.length) {
    frag.append(h('p', { class: 'empty' }, 'No comments on this PR yet.'));
    return frag;
  }
  const sections = [
    group('On this page', anchored.map((t) => item(t, null, () => { cb.onSelect(t, false); }))),
    group(
      'Outdated',
      outdated.map((t) => item(t, `pinned at ${t.root.meta.sha.slice(0, 7)}`, () => { cb.onSelect(t, true); })),
      'Their element changed or is gone.',
    ),
    group(
      'Other pages',
      elsewhere.map((t) => item(t, t.root.meta.url, () => { window.location.assign(t.root.meta.url); })),
    ),
    group('Resolved', resolved.map((t) => item(t, t.stateChangedBy ? `by ${t.stateChangedBy}` : null, () => { cb.onSelect(t, false); }))),
  ].filter((s): s is HTMLElement => !!s);
  if (!sections.length) frag.append(h('p', { class: 'empty' }, 'No comments on this page.'));
  frag.append(...sections);
  return frag;
}
