import {beforeEach,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn(),branch:vi.fn(),language:vi.fn(),normalize:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:state.identity}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:state.rpc})}));
vi.mock('@/lib/logging/logger.mjs',()=>({withLogContext:(_context:unknown,work:()=>unknown)=>work()}));
vi.mock('./paid-setup-actions',()=>({readOwnedPaidBranchSetupAction:state.branch}));
vi.mock('./paid-reply-language-actions',()=>({readOwnedBranchReplyLanguageAction:state.language}));
vi.mock('./paid-launch-projection',()=>({normalizePaidLaunchSnapshot:state.normalize}));
import {readOwnedBranchLaunchSummaryAction} from './paid-launch-actions';

const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333'};
beforeEach(()=>{
 vi.resetAllMocks();
 state.identity.mockResolvedValue({ok:true,userId:scope.expectedAccountId});
 state.rpc.mockResolvedValue({data:{ok:true,data:{snapshot:'native-snapshot'}},error:null});
 state.branch.mockResolvedValue('branch');state.language.mockResolvedValue('language');
 state.normalize.mockReturnValue('normalized');
});

it('starts the language read while branch data is pending and withholds the result until both finish',async()=>{
 let releaseBranch!:(value:string)=>void;
 let languageStarted!:()=>void;
 const started=new Promise<void>(resolve=>{languageStarted=resolve;});
 state.branch.mockImplementation(()=>new Promise<string>(resolve=>{releaseBranch=resolve;}));
 state.language.mockImplementation(async()=>{languageStarted();return 'language';});
 const pending=readOwnedBranchLaunchSummaryAction(scope);
 await started;
 expect(state.branch).toHaveBeenCalledWith(scope);
 expect(state.normalize).not.toHaveBeenCalled();
 releaseBranch('branch');
 await expect(pending).resolves.toBe('normalized');
 expect(state.normalize).toHaveBeenCalledWith('native-snapshot',scope,'branch','language');
});

it.each(['identity','authority','summary'])('does not start dependent reads after %s denial',async(stage)=>{
 if(stage==='identity')state.identity.mockResolvedValue({ok:false});
 else if(stage==='authority')state.rpc.mockResolvedValue({data:{ok:false},error:null});
 else state.rpc.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValueOnce({data:{ok:false},error:null});
 await expect(readOwnedBranchLaunchSummaryAction(scope)).resolves.toBeNull();
 expect(state.branch).not.toHaveBeenCalled();expect(state.language).not.toHaveBeenCalled();
});

it('preserves an unavailable language result without inventing confirmation',async()=>{
 state.language.mockRejectedValue(Error('unavailable'));
 await readOwnedBranchLaunchSummaryAction(scope);
 expect(state.normalize).toHaveBeenCalledWith('native-snapshot',scope,'branch',null);
});

it('does not normalize or return a snapshot when branch loading fails',async()=>{
 state.branch.mockRejectedValue(Error('branch unavailable'));
 await expect(readOwnedBranchLaunchSummaryAction(scope)).rejects.toThrow('branch unavailable');
 expect(state.normalize).not.toHaveBeenCalled();
});
