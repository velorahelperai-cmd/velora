import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('@/lib/knowledge/knowledge-import-actions',()=>({previewKnowledgeImport:vi.fn(),confirmKnowledgeImport:vi.fn()}));vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>null}));
import {KnowledgeImportReview} from './knowledge-import-review';
it('requires selected rights consent and write ability before preview, without automatic source confirmation',()=>{const html=renderToStaticMarkup(<KnowledgeImportReview companyId="business" expectedUserId="owner" canWrite={true} ar={false}/>);expect(html).toContain('permission to use');expect(html).toContain('requires approval');expect(html).toContain('disabled=""');expect(html).not.toContain('Confirm new source');});
