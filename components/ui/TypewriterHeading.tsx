"use client";
import { useEffect, useState } from "react";

export default function TypewriterHeading({
  text,
  onDone,
}: {
  text: string;
  onDone?: () => void;
}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); onDone?.(); }
    }, 35);
    return () => clearInterval(id);
  }, [text]);

  return (
    <h2
      className="cg-display"
      style={{
        fontSize: "clamp(32px, 4.6vw, 60px)",
        color: "var(--c-text)",
        textAlign: "center",
        margin: "20px 0 12px",
        padding: "0 16px",
        width: "100%",
        maxWidth: "640px",
      }}
    >
      <span>
        {displayed}
        {!done && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: "0.09em",
              height: "0.78em",
              marginLeft: "0.08em",
              verticalAlign: "-0.04em",
              background: "var(--c-accent)",
              animation: "twCursorBlink 0.8s step-end infinite",
            }}
          />
        )}
      </span>
      <style>{`@keyframes twCursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </h2>
  );
}
