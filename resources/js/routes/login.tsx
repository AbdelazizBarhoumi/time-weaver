import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLogin, useRegister } from "@/lib/queries";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      if (isLogin) {
        await loginMutation.mutateAsync({ email, password });
      } else {
        await registerMutation.mutateAsync({ name, email, password, password_confirmation: confirmPassword });
      }
      navigate({ to: '/' });
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
      setError(axiosError.response?.data?.message || "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-void grid-bg font-display text-ink flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-panel rounded-xl ring-1 ring-line p-8">
          <div className="text-center mb-8">
            <div className="font-mono text-[11px] tracking-[0.2em] text-mut">SHIFTGRID</div>
            <h1 className="mt-2 text-2xl font-semibold">{isLogin ? "Welcome back" : "Create account"}</h1>
            <p className="mt-1 text-sm text-mut">
              {isLogin ? "Sign in to track your work hours" : "Start tracking your work hours"}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-500/10 ring-1 ring-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-mut mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-void ring-1 ring-line focus:ring-neon/40 focus:outline-none"
                  placeholder="Your name"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-mut mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-void ring-1 ring-line focus:ring-neon/40 focus:outline-none"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-mut mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-void ring-1 ring-line focus:ring-neon/40 focus:outline-none"
                placeholder="••••••••"
                required
                minLength={8}
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-mut mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-void ring-1 ring-line focus:ring-neon/40 focus:outline-none"
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending || registerMutation.isPending}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-neon/10 ring-1 ring-neon/40 text-neon font-mono text-sm hover:bg-neon/20 transition disabled:opacity-50"
            >
              {isLogin
                ? loginMutation.isPending
                  ? "Signing in..."
                  : "Sign in"
                : registerMutation.isPending
                  ? "Creating account..."
                  : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-mut">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-neon hover:underline font-mono"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>

          <div className="mt-6 text-center">
            <Link
              to="/"
              className="text-sm text-mut hover:text-ink font-mono"
            >
              ← Back to app
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}