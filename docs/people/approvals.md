# Approvals

A colleague hitting a wall is the normal case, not a failure. What matters is
that the wall has a door in it.

## Asking

When somebody needs something their role does not cover, the agent puts it to
you with `ask_primary`, and it arrives wherever [routine reports](/guide/routines)
go:

```
Priya (telegram:100200300) is asking (via telegram):

Priya wants me to check the inbox and summarise anything urgent.

It wants to run, exactly once:

    himalaya envelope list --mailbox Inbox --page-size 3

Approving runs that and nothing else.
```

The id after the name is who the platform says is asking. A name is whatever
somebody called themselves, and one can be changed to look like somebody else's;
the id cannot.

For `edit_image` the action is the path of each picture, one to a line, in the
order of the call (a single picture is just its path), and the agent is told
exactly which when the call is refused. The prompt is not part of what is
approved. **Always allow** then writes one rule for each picture, since a rule is
matched against each picture of a call and one for all of them would match none.

The agent chooses neither the recipient nor the route. A session working for
somebody else must not be able to pick who hears from it.

## Answering

Three answers. On a channel that draws buttons you get **Approve once**,
**Always allow** and **Deny**; everywhere else the same thing as text:

| Reply | Effect |
| --- | --- |
| `#abcd approve` | That exact command runs, once, within 15 minutes |
| `#abcd always` | Writes a [standing rule](/people/rules) for that person |
| `#abcd no` | Refused, and they are told |

Anything else is relayed to them as an ordinary answer and **authorises
nothing**. Only the literal word `always` creates a standing permission —
something that outlives the conversation should never come from a reply that
merely sounded enthusiastic.

The `#abcd` prefix is what makes it an answer rather than a remark. It is
matched only at the start of a message and only against a question still
waiting, so a message that merely begins with a hash reaches the agent normally.

::: tip Buttons are the text
A button's payload is exactly the message it stands for. Tapping **Approve
once** sends `#abcd approve` down the same path as typing it, so nothing behaves
differently depending on how you answered.
:::

## What happens next

The conversation picks itself back up. The agent runs what was approved and
tells the person who asked what came of it — you do not go and prod it, and
neither do they.

A refusal resumes it too. Being told no is an outcome worth delivering; silence
reads as the question having been lost.

The resumed turn runs **as that conversation**, so a colleague's session is
still a colleague's session. The approval permits one action inside it, not a
promotion.

## What an approval is not

::: warning It authorises the command you were shown
One conversation, one use, fifteen minutes. Matching is exact — approving
`himalaya envelope list --page-size 3` does not cover `--page-size 5`, which is
the safe failure direction and does mean an approval can quietly not apply if
the agent rephrases.
:::

Saying yes to one command does not make somebody trusted for the next one. If
you find yourself approving the same thing repeatedly, that is what **Always
allow** is for.

## When the answer cannot get back

Some channels can only reply to a message already open — a webhook without a
callback URL. Asking still works: the question reaches you, and the answer is
held and delivered the next time that person writes. The notification says which
of the two you are getting.
