"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { INSTALL } from "@/content/install";

function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };

  return (
    <div className="install__cmd">
      <code className="install__code">
        <span className="install__prompt" aria-hidden="true">
          $
        </span>
        {command}
      </code>
      <button type="button" className="install__copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="install__sr" role="status">
        {copied ? "Command copied to clipboard" : ""}
      </span>
    </div>
  );
}

/**
 * Install: the marketplace route is the hero of the section (screenshot, three
 * steps, one button). The manual VSIX route sits quietly underneath.
 */
export default function InstallSection({ decorative = false }) {
  const { shot, steps, actions, manual } = INSTALL;

  return (
    <section
      className="install"
      id={decorative ? undefined : "install"}
      aria-hidden={decorative ? true : undefined}
      inert={decorative ? true : undefined}
    >
      <header className="install__head">
        <h2 className="install__title">{INSTALL.title}</h2>
        <p className="install__lede">{INSTALL.lede}</p>
      </header>

      <figure className="install__frame">
        <Image
          className="install__shot"
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          sizes="(max-width: 1080px) 88vw, 980px"
          quality={85}
        />
      </figure>

      <ol className="install__steps">
        {steps.map((step, index) => (
          <li key={step.title} className="install__step">
            <span className="install__num">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="install__label">{step.title}</span>
            <span className="install__aside">
              {step.keys
                ? step.keys.map((key) => (
                    <kbd key={key} className="install__key">
                      {key}
                    </kbd>
                  ))
                : step.note}
            </span>
          </li>
        ))}
      </ol>

      <div className="install__actions">
        {actions.map((action) => (
          <a
            key={action.label}
            className={`btn btn--${action.variant}`}
            href={action.href}
            {...(action.external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {action.label}
          </a>
        ))}
      </div>

      <div className="install__manual">
        <h3 className="install__manual-title">{manual.title}</h3>
        <p className="install__manual-body">
          {manual.body}{" "}
          <a
            className="install__link"
            href={manual.link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {manual.link.label}
          </a>
        </p>
        <CopyCommand command={manual.command} />
      </div>
    </section>
  );
}
