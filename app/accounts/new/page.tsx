import { NewAccountForm } from "./new-account-form";

export const dynamic = "force-dynamic";

export default function NewAccountPage() {
  return (
    <div className="px-4 pt-6 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Nova conta</h1>
      <NewAccountForm />
    </div>
  );
}
