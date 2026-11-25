import type { APIRoute } from 'astro';
import { app } from '../../server/app';

export const ALL: APIRoute = async (context) => {
  const { env, ctx } = context.locals.runtime;
  return app.fetch(context.request, env, ctx);
};
