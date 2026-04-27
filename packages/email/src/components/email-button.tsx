import { Button } from "@react-email/components";

interface EmailButtonProps {
  readonly label: string;
  readonly href: string;
}

export function EmailButton({ label, href }: EmailButtonProps): React.JSX.Element {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: "#003A49",
        color: "#FFFFFF",
        fontFamily: "'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
        fontSize: "13px",
        fontWeight: 600,
        letterSpacing: "0.01em",
        padding: "11px 22px",
        borderRadius: "3px",
        textDecoration: "none",
        display: "inline-block",
      }}>
      {label}
    </Button>
  );
}

export default EmailButton;
