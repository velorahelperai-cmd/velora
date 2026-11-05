'use client';

export type InboxDetailsTab = 'details' | 'followup' | 'activity';

export function InboxDetailsTabs({ar, value, onChange}:{ar:boolean;value:InboxDetailsTab;onChange(value:InboxDetailsTab):void}) {
  const tabs: {value:InboxDetailsTab;label:string}[] = [
    {value:'details',label:ar?'التفاصيل':'Details'},
    {value:'followup',label:ar?'المتابعة':'Follow-up'},
    {value:'activity',label:ar?'النشاط':'Activity'},
  ];
  return <div className="inbox-v2-details-tabs" role="tablist" aria-label={ar?'معلومات المحادثة':'Conversation information'}>{tabs.map((tab,index)=><button
    key={tab.value} type="button" role="tab" id={`wa-details-tab-${tab.value}`}
    aria-controls={`wa-details-panel-${tab.value}`} aria-selected={value===tab.value} tabIndex={value===tab.value?0:-1}
    onClick={()=>onChange(tab.value)} onKeyDown={event=>{
      let next:number|undefined;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=tabs.length-1;
      if(event.key==='ArrowRight')next=(index+(ar?-1:1)+tabs.length)%tabs.length;
      if(event.key==='ArrowLeft')next=(index+(ar?1:-1)+tabs.length)%tabs.length;
      if(next!==undefined){event.preventDefault();onChange(tabs[next].value);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();}
    }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {tab.value==='details'?<><circle cx="10" cy="7" r="3"/><path d="M4 20v-2a6 6 0 0 1 12 0v2m3-14v6m-3-3h6"/></>:tab.value==='followup'?<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>:<path d="M2 12h5l3-8 4 16 3-8h5"/>}
    </svg>{tab.label}</button>)}</div>;
}
