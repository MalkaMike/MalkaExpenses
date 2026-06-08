"use client";
import { createContext, useContext, useState } from "react";

type SidebarCtx = { open: boolean; toggle: () => void; close: () => void };

const AdminSidebarCtx = createContext<SidebarCtx>({
  open: false,
  toggle: () => {},
  close: () => {},
});

export function AdminSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AdminSidebarCtx.Provider
      value={{ open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) }}
    >
      {children}
    </AdminSidebarCtx.Provider>
  );
}

export function useAdminSidebar() {
  return useContext(AdminSidebarCtx);
}
