import { clerkMiddleware } from '@clerk/nextjs/server';

// Next.js 16 renomeou o arquivo de convenção "middleware.ts" para
// "proxy.ts" (mesma funcionalidade); a função exportada pelo Clerk continua
// se chamando clerkMiddleware.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Roda em tudo, exceto arquivos estáticos e internals do Next.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
