"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login">
      <h1>Не удалось загрузить страницу</h1>
      <p>
        Повторите попытку. Если ошибка сохраняется, обратитесь к администратору.
      </p>
      <button onClick={reset}>Повторить</button>
    </main>
  );
}
