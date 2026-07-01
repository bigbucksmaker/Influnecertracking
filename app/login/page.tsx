import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInGoogle, signInDev } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  const devBypass = process.env.DEV_AUTH_BYPASS === "true";
  const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "atomikgrowth.com";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            A
          </span>
          <div>
            <div className="font-semibold text-slate-900">Atomik Growth</div>
            <div className="text-xs text-slate-500">Influencer Tracking</div>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Internal tool. Access is restricted to <b>@{domain}</b> Google accounts.
        </p>

        <form action={signInGoogle} className="mt-6">
          <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <GoogleIcon />
            Continue with Google
          </button>
        </form>

        {devBypass && (
          <form action={signInDev} className="mt-3">
            <button className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
              Dev sign in (local only)
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
      <path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.5 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-3.7-13.7-9.9l-7.8 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}
