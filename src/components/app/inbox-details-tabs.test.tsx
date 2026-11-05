import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {InboxDetailsTabs} from './inbox-details-tabs';
import {ComposerTabs} from './conversation-presentation';

it.each([true,false])('renders three labelled details tabs with one selected in both languages: ar=%s',ar=>{
 const html=renderToStaticMarkup(<InboxDetailsTabs ar={ar} value="followup" onChange={vi.fn()}/>);
 expect((html.match(/role="tab"/g)||[])).toHaveLength(3);
 expect((html.match(/aria-selected="true"/g)||[])).toHaveLength(1);
 expect(html).toContain('aria-controls="wa-details-panel-followup"');
 expect(html).toContain(ar?'المتابعة':'Follow-up');
});
it('keeps the reference composer order without starting any action',()=>{
 const change=vi.fn();
 const html=renderToStaticMarkup(<ComposerTabs id="composer" ar mode="message" onChange={change}/>);
 expect(html.indexOf('composer-tab-message')).toBeLessThan(html.indexOf('composer-tab-ai'));
 expect(html.indexOf('composer-tab-ai')).toBeLessThan(html.indexOf('composer-tab-note'));
 expect(change).not.toHaveBeenCalled();
});
