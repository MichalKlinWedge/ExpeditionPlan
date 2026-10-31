import { NewTripForm } from "@/components/forms";
import { Shell } from "@/components/shell";

export default function NewTripPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Nowy wyjazd</h1>
      <NewTripForm />
    </Shell>
  );
}
