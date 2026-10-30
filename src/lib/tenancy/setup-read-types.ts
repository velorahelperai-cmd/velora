import type {readOwnedPaidSetupShellAction,readOwnedPaidSetupWorkspaceAction} from './paid-setup-workspace-actions';
import type {readOwnedBranchHoursAction} from './branch-hours-actions';
import type {readOwnedBranchKnowledgeAction} from './paid-branch-knowledge-actions';
import type {readOwnedBranchReplyLanguageAction} from './paid-reply-language-actions';
import type {readOwnedBranchAssistantTrialAction} from './paid-assistant-trial-actions';
import type {readOwnedBranchTeamAction} from './paid-team-actions';
import type {readOwnedBranchLaunchSummaryAction} from './paid-launch-actions';

export type SetupReadScope={expectedAccountId:string;companyId:string;branchId:string;boundaryFingerprint:string};
export type SetupReads={
 shell:Awaited<ReturnType<typeof readOwnedPaidSetupShellAction>>;
 workspace:Awaited<ReturnType<typeof readOwnedPaidSetupWorkspaceAction>>;
 hours:Awaited<ReturnType<typeof readOwnedBranchHoursAction>>;
 knowledge:Awaited<ReturnType<typeof readOwnedBranchKnowledgeAction>>;
 language:Awaited<ReturnType<typeof readOwnedBranchReplyLanguageAction>>;
 trial:Awaited<ReturnType<typeof readOwnedBranchAssistantTrialAction>>;
 team:Awaited<ReturnType<typeof readOwnedBranchTeamAction>>;
 launch:Awaited<ReturnType<typeof readOwnedBranchLaunchSummaryAction>>;
};
