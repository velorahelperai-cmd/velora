import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
import type {WhatsappCompanyLink} from '@/lib/whatsapp/connection';
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/lib/whatsapp/connection-actions',()=>({getWhatsappCompanyLink:vi.fn(),saveWhatsappLinkRequest:vi.fn()}));
vi.mock('./whatsapp-embedded-signup',()=>({WhatsappEmbeddedSignup:({connected}:{connected:boolean})=><div data-connected={connected}/>}));
vi.mock('./whatsapp-fixed-ack-opt-in',()=>({WhatsappFixedAckOptIn:()=>null}));
vi.mock('./whatsapp-message-evidence',()=>({WhatsappMessageEvidence:()=> <div>Actual message evidence</div>}));
vi.mock('./channel-review',()=>({ChannelReviewStatus:()=>null}));
vi.mock('./ui',()=>({useAppCopy:()=>({setup:{title:'Setup'},app:new Proxy({tabs:{whatsapp:'WhatsApp'},waLinkStatuses:{verified:'Verified',disconnected:'Disconnected'}},{get:(o,k)=>Reflect.get(o,k)??String(k)})}),useAction:()=>({busy:false,run:vi.fn()}),isPhone:()=>true,Card:({children}:{children:React.ReactNode})=><section>{children}</section>,Button:({children}:{children:React.ReactNode})=><button>{children}</button>,Notice:({children}:{children:React.ReactNode})=><p>{children}</p>,Field:()=>null}));
import {WhatsappSettingsPanel} from './whatsapp-settings-panel';
const link:WhatsappCompanyLink={id:'link',companyId:'company',requestedDisplayNumber:'',keepOnPhone:false,status:'verified',verifiedDisplayNumber:'+17112778333',inboundTestedAt:null,outboundTestedAt:null,receptionSendTested:false,priorLinkEvidence:false,lastErrorCode:null,createdAt:null,updatedAt:null,authorizationReady:true,authorizationExpiresAt:null};
it('recognizes a verified provider number without a manually requested number and separates incomplete test records',()=>{
 const html=renderToStaticMarkup(<WhatsappSettingsPanel companyId="company" initialLink={link}/>);
 expect(html).toContain('data-connected="true"');expect(html).not.toContain('Awaiting number registration');expect(html).toContain('Actual message evidence');expect(html).toContain('Incomplete; message evidence is shown separately');expect(html).toContain('Live sending readiness');
});
it('does not use historical verified number to complete a disconnected or failed read',()=>{
 for(const props of [{initialLink:{...link,status:'disconnected' as const}},{initialLink:link,initialLoadFailed:true}]){
 const html=renderToStaticMarkup(<WhatsappSettingsPanel companyId="company" {...props}/>);
 expect(html).toContain('data-connected="false"');expect(html).toContain('Awaiting number registration');expect(html).not.toContain('Actual message evidence');
 }
});
