export type StepState = "todo" | "current" | "done";

export type Step = {
  id: string;
  label: string;
  state: StepState;
};

export type StepperProps = {
  steps: Step[];
  "aria-label"?: string;
};

export function Stepper({
  steps,
  "aria-label": ariaLabel = "Progress",
}: StepperProps) {
  return (
    <ol className="n-stepper" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="n-stepper__item"
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="n-stepper__num" aria-hidden>
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
