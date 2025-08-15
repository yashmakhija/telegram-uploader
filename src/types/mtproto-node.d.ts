declare module "@mtproto/core/envs/node/index.js" {
  export default class MTProto {
    constructor(options: {
      api_id: number;
      api_hash: string;
      storageOptions?: {
        path: string;
      };
      customDc?: number;
    });

    call(method: string, params?: any, options?: any): Promise<any>;
    updates: {
      on(event: string, handler: (message: any) => void): void;
    };
  }
}
