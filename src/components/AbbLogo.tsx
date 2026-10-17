type AbbLogoProps = {
  className?: string;
};

export function AbbLogo({ className = "h-7 w-auto" }: AbbLogoProps) {
  return <img src="/abb-logo.png" alt="ABB" className={className} />;
}
