declare module "@mtproto/core" {
  export class MTProto {
    constructor(options: {
      api_id: number;
      api_hash: string;
      storageOptions?: {
        path: string;
      };
    });

    call(method: string, params?: any, options?: any): Promise<any>;
    updates: {
      on(event: string, handler: (message: any) => void): void;
    };
  }
}
