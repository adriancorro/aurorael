import { Analytics } from "@vercel/analytics/react";

export const metadata = {
  title: "Aurorael",
  description: "Artificial intelligence with critical thinking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        {children}
        <Analytics /> {/*  Activamos analíticas */}
      </body>
    </html>
  );
}
