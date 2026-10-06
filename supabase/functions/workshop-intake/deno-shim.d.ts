// Solo para el typecheck local con tsc (sin Deno instalado): declara las APIs de Deno que usa index.ts.
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  env: { get(key: string): string | undefined };
};
