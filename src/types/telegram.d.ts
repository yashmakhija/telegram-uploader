declare module "telegram" {
  export namespace Api {
    interface Document {
      id: string | number;
      [key: string]: any;
    }
  }
}
