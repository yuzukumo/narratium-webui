"use client";

import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      reverseOrder={false}
      gutter={10}
      containerStyle={{
        top: 16,
        right: 16,
      }}
      toastOptions={{
        duration: 3600,
        style: {
          maxWidth: "min(26rem, calc(100vw - 2rem))",
          border: "1px solid rgba(148, 119, 77, 0.72)",
          borderRadius: "6px",
          background: "#1d1a18",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 225, 170, 0.05)",
          color: "#f4e8c1",
          fontSize: "0.875rem",
          lineHeight: "1.4",
          padding: "0.75rem 0.875rem",
          wordBreak: "break-word",
        },
        success: {
          duration: 3200,
          iconTheme: {
            primary: "#d9ad62",
            secondary: "#1d1a18",
          },
        },
        error: {
          duration: 4800,
          iconTheme: {
            primary: "#dc8d78",
            secondary: "#1d1a18",
          },
        },
        loading: {
          iconTheme: {
            primary: "#c89b55",
            secondary: "#332b23",
          },
        },
      }}
    />
  );
}
