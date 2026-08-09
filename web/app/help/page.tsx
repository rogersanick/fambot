import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const EXAMPLES = [
  ["Add a task", "@fambot remind Jess to buy cucumbers this evening"],
  ["Add an event", "@fambot dentist appointment Friday at 3pm"],
  ["Complete", "@fambot done with the cucumbers"],
  ["List", "@fambot what's on our list?"],
  ["Delete", "@fambot delete the dentist appointment"],
  ["Link your account", "@fambot link"],
  ["Rename the bot", "@fambot call yourself Jerry"],
  ["Pause everything", "@fambot stop"],
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">How FamBot works</h1>
      <p className="mt-2 text-muted-foreground">
        FamBot lives in your iMessage group chat and keeps shared tasks and events. Tag it in
        plain language — every reply links back to this portal.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Things you can say</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {EXAMPLES.map(([label, example]) => (
            <div key={label} className="grid gap-1">
              <span className="text-sm font-medium">{label}</span>
              <code className="rounded bg-muted px-2 py-1 text-sm">{example}</code>
            </div>
          ))}
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Always tag the bot.</strong> FamBot only reads
          messages that mention it — including answers to its questions. If it asked you
          something, start your reply with <code className="rounded bg-muted px-1">@fambot</code>.
        </p>
        <p>
          <strong className="text-foreground">Context.</strong> When you tag @fambot, it may
          temporarily use up to the last 8 text messages from the previous 10 minutes in the chat
          to understand context. These surrounding messages are not saved.
        </p>
        <p>
          <strong className="text-foreground">Renaming.</strong> You can rename the bot with
          &quot;@fambot call yourself &lt;name&gt;&quot;; &quot;fambot&quot; always keeps working
          too.
        </p>
        <p>
          <strong className="text-foreground">Getting started.</strong> New group chat? Just text
          &quot;@fambot setup &lt;your household name&gt;&quot; and follow along.
        </p>
      </div>
    </main>
  );
}
