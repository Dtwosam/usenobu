"use client";

import { useId, useState } from "react";

export function OkxExampleCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="n-code-block" data-testid="okx-example-request">
      <pre>
        <code>{text}</code>
      </pre>
      <button
        type="button"
        className="n-code-block__copy"
        onClick={onCopy}
        data-testid="okx-example-copy"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {copied ? (
        <span className="visually-hidden" role="status">
          Example request copied
        </span>
      ) : null}
    </div>
  );
}

type FaqItem = { q: string; a: string };

export function OkxFaq({ items }: { items: FaqItem[] }) {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="n-faq" data-testid="okx-faq">
      {items.map((item, index) => {
        const expanded = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-btn-${index}`;
        return (
          <div key={item.q} className="n-faq__row">
            <button
              type="button"
              id={buttonId}
              className="n-faq__question"
              aria-expanded={expanded}
              aria-controls={panelId}
              data-testid={`okx-faq-q-${index}`}
              onClick={() => setOpenIndex(expanded ? null : index)}
            >
              <span>{item.q}</span>
              <span aria-hidden>{expanded ? "−" : "+"}</span>
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!expanded}
              className="n-faq__answer-wrap"
            >
              <p className="n-faq__answer">{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
