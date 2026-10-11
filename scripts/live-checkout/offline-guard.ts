import{vi}from"vitest";vi.stubGlobal("fetch",async()=>{throw Error("OFFLINE_PROVIDER_FETCH_FORBIDDEN");});export{};
