import type { ReactNode } from "react";
import type { Metadata } from "next";

import { Providers } from "./providers";
import "./styles.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Loan review workbench",
  description: "Manual underwriting decision workspace",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
