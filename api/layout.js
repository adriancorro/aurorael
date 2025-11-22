import { Analytics } from "@vercel/analytics/react";

export const metadata = {
  title: "Hegel 2052",
  description: "Reflexión dialéctica del espíritu moderno",
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
