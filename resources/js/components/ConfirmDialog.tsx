import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive action. */
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: string;
  /** Label shown above the text field. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Refuse to submit an empty value. */
  required?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
/** Resolves with the entered text, or null when the user cancels. */
type PromptFn = (options: PromptOptions) => Promise<string | null>;

interface DialogContextValue {
  confirm: ConfirmFn;
  prompt: PromptFn;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error("useConfirm/usePrompt must be used inside <ConfirmProvider>");
  }

  return context;
}

/** Ask the user to confirm an action with an in-app modal. */
export function useConfirm(): ConfirmFn {
  return useDialogContext().confirm;
}

/** Ask the user for a short piece of text with an in-app modal. */
export function usePrompt(): PromptFn {
  return useDialogContext().prompt;
}

/** Hosts the confirm and prompt modals for the whole app; mount once near the root. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolve = useRef<((confirmed: boolean) => void) | null>(null);

  const [promptOptions, setPromptOptions] = useState<PromptOptions | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptValue, setPromptValue] = useState("");
  const promptResolve = useRef<((value: string | null) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A second question while one is pending dismisses the first.
    confirmResolve.current?.(false);
    setConfirmOptions(next);
    setConfirmOpen(true);

    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
    });
  }, []);

  const settleConfirm = useCallback((confirmed: boolean) => {
    confirmResolve.current?.(confirmed);
    confirmResolve.current = null;
    setConfirmOpen(false);
  }, []);

  const prompt = useCallback<PromptFn>((next) => {
    promptResolve.current?.(null);
    setPromptOptions(next);
    setPromptValue(next.defaultValue ?? "");
    setPromptOpen(true);

    return new Promise<string | null>((resolve) => {
      promptResolve.current = resolve;
    });
  }, []);

  const settlePrompt = useCallback((value: string | null) => {
    promptResolve.current?.(value);
    promptResolve.current = null;
    setPromptOpen(false);
  }, []);

  // Never leave a caller awaiting forever if the provider goes away.
  useEffect(
    () => () => {
      confirmResolve.current?.(false);
      promptResolve.current?.(null);
    },
    [],
  );

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next) settleConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmOptions?.title}</AlertDialogTitle>
            {confirmOptions?.description && (
              <AlertDialogDescription className="whitespace-pre-line">{confirmOptions.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>
              {confirmOptions?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settleConfirm(true)}
              className={cn(
                confirmOptions?.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {confirmOptions?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={promptOpen}
        onOpenChange={(next) => {
          if (!next) settlePrompt(null);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            // Keep focus in the text field instead of jumping to the buttons.
            event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{promptOptions?.title}</AlertDialogTitle>
            {promptOptions?.description && (
              <AlertDialogDescription className="whitespace-pre-line">{promptOptions.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-provider-input">{promptOptions?.label ?? "Name"}</Label>
            <Input
              id="confirm-provider-input"
              autoFocus
              value={promptValue}
              placeholder={promptOptions?.placeholder}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (promptOptions?.required && promptValue.trim() === "") return;
                settlePrompt(promptValue);
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settlePrompt(null)}>
              {promptOptions?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(promptOptions?.required) && promptValue.trim() === ""}
              onClick={() => settlePrompt(promptValue)}
            >
              {promptOptions?.confirmLabel ?? "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContext.Provider>
  );
}
