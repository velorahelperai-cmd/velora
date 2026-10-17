declare module "pg" {
  export class Client {
    constructor(options: { connectionString: string });
    connect(): Promise<void>;
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
