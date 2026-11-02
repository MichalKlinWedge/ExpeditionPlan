import Link from "next/link";

import { CompassIcon } from "@/components/icons";
import { Shell } from "@/components/shell";

/** Nieznany adres albo wyjazd, do którego nie ma dostępu (RLS zwraca pusto → `notFound()`). */
export default function NotFound() {
  return (
    <Shell>
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <CompassIcon className="size-12 text-sea" />
        <h1 className="text-2xl font-semibold">Zboczyliśmy ze szlaku</h1>
        <p className="text-sm text-zinc-500">
          Tej strony nie ma albo nie masz dostępu do tego wyjazdu. Jeśli ktoś przysłał ci plan, poproś o link z zaproszeniem.
        </p>
        <Link href="/" className="btn-primary">
          Moje wyjazdy
        </Link>
      </div>
    </Shell>
  );
}
