import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SubscriptionActivationState} from './subscription-activation-state';
import type {ActivationState} from '@/lib/billing/activation';
const waiting:ActivationState={companyId:'company',state:'waiting',paymentConfirmedAt:'2026-10-14T00:00:00Z',entitlementCreatedAt:'2026-10-14T00:00:01Z',activationDeadline:'2026-10-28T00:00:00Z',subscriptionStartedAt:null,expiresAt:null,operationalReady:false,bonusDays:7,paused:false,legacy:false};
it('payment confirmation is displayed independently of readiness and expiry',()=>{const html=renderToStaticMarkup(<SubscriptionActivationState value={waiting} ar={false}/>);expect(html).toContain('Payment is confirmed');expect(html).toContain('Setup deadline');expect(html).not.toContain('Subscription expiry');});
it('deadline-started service does not falsely display operational success',()=>{const html=renderToStaticMarkup(<SubscriptionActivationState value={{...waiting,state:'active',subscriptionStartedAt:waiting.activationDeadline,expiresAt:'2026-12-04T00:00:00Z'}} ar={false}/>);expect(html).toContain('Automated replies await operational readiness');expect(html).not.toContain('operation is ready');});
