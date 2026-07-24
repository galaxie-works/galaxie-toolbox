import { cn } from "@/lib/utils";

/**
 * Foto do perfil do usuario, com as iniciais como reserva.
 * A foto vem do Graph (/me/photo) como data URI; nem todo mundo tem uma.
 */
export function Avatar({
  photo,
  initials,
  size = 36,
  className,
}: {
  photo?: string | null;
  initials: string;
  size?: number;
  className?: string;
}) {
  const estilo = { width: size, height: size };
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        draggable={false}
        style={estilo}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      style={{ ...estilo, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground",
        className
      )}
    >
      {initials}
    </div>
  );
}
