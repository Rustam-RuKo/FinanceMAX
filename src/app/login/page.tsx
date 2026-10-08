"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="brand">
        ФМ <span>ФинансМАКС</span>
      </div>
      <h1>Вход в систему</h1>
      <p>Финансовое управление аудиторской компании</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          try {
            const response = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(Object.fromEntries(form)),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error.message);
            location.href = "/dashboard";
          } catch (error) {
            setError(error instanceof Error ? error.message : "Ошибка входа");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Электронная почта
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
      </form>
      <small>Доступ предоставляется только авторизованным пользователям.</small>
    </main>
  );
}
