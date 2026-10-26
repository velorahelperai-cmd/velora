import { describe, expect, it } from 'vitest';
import { runDeletionStep, type DeletionPort } from './runner';

describe('resumable deletion worker', () => {
  function fixture(state = 'PENDING', stage = 'AUTH') {
    const events: string[] = [];
    const port = {
      authorize: async () => { events.push('authorize'); },
      claim: async () => ({ stage, state, claim: 'claim', target: 'target', objects: [] }),
      inspect: async () => { events.push('inspect'); return 'ABSENT' as const; },
      remove: async () => { events.push('remove'); },
      finish: async (outcome: string) => { events.push(outcome); },
    } as DeletionPort;
    return { port, events };
  }
  it('reconciles a lost response without repeating successful Auth deletion', async () => {
    const { port, events } = fixture('UNKNOWN');
    await runDeletionStep(port);
    expect(events).toEqual(['authorize', 'inspect', 'authorize', 'SUCCEEDED']);
  });
  it('does not execute a stage another tab already owns or completed', async () => {
    const { port, events } = fixture(); port.claim = async () => null;
    await runDeletionStep(port); expect(events).toEqual(['authorize']);
  });
  it('does not repeat an uncertain effect until the effect has been inspected', async () => {
    const { port, events } = fixture('UNKNOWN'); port.inspect = async () => 'UNKNOWN';
    await runDeletionStep(port); expect(events).toEqual(['authorize','authorize','UNKNOWN']);
  });
  it('records provider exceptions as UNKNOWN without logging their sensitive message', async () => {
    const { port, events } = fixture(); port.inspect = async () => 'PRESENT';
    port.remove = async () => { throw Error('OTP/token/secret'); };
    await runDeletionStep(port); expect(events.at(-1)).toBe('UNKNOWN');
    expect(events.join()).not.toContain('secret');
  });
  it('rechecks authority before external effects and refuses revoked admins', async () => {
    const { port, events } = fixture(); port.inspect = async () => 'PRESENT';
    let n=0; port.authorize = async () => { if(++n===2) throw Error('FORBIDDEN'); };
    await expect(runDeletionStep(port)).rejects.toThrow('FORBIDDEN');
    expect(events).not.toContain('remove');
  });
  it('session loss after effect leaves readback reconciliation for the next authorized request',async()=>{
    const {port,events}=fixture();let checks=0;let deleted=false;
    port.inspect=async()=>deleted?'ABSENT':'PRESENT';port.remove=async()=>{deleted=true;events.push('remove');};
    port.authorize=async()=>{if(++checks===3)throw Error('FORBIDDEN');};
    await expect(runDeletionStep(port)).rejects.toThrow('FORBIDDEN');expect(events).toEqual(['remove']);
    port.authorize=async()=>{};await runDeletionStep(port);expect(events).toEqual(['remove','SUCCEEDED']);
  });
});
