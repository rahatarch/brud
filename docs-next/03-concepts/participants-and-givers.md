# Participants and givers

Every piece of software in BrudOS is a participant, and every API it offers is controlled by that participant, the giver. This page defines both terms.

## Participants

A **participant** is any piece of software the kernel hosts. A filesystem service, an agent tool, a settings store, your own app logic: all participants. The kernel treats them identically. There is no special class for "built-in" services beyond the seven hardcores.

A participant is an ES module that exports `createService`. It returns a **service descriptor**: a token (its name), a tier, its dependencies, a manifest, and a factory that builds its instance.

You rarely write the descriptor by hand. `defineParticipant` from `@brud/sdk/participant` builds it from a friendlier definition. You write it by hand only when you need manifest keys the SDK does not cover, such as `kinds`, `events` or `interceptions`.

## Givers

When a participant offers an API for others to call, it is acting as a **giver** for that API. The API itself is called an **exposure**.

The giver is the authority over its exposure. It decides:

- which kinds of caller may reach it (*scope* and *policy*),
- what each caller actually receives (the *projection*),
- what to refuse.

The kernel's role is narrow: route every call to the giver and enforce the giver's answer. It does not make policy for the giver.

## Requests are not grants

A participant also says what it wants from others: the capabilities it needs (`requests.capabilities` in the manifest). This is a **request**. The capability only matters if a giver's policy looks for it. Asking for something never gives it to you.

Put together:

```text
caller declares   ->  "I want capability vault:read"          (a request)
giver declares    ->  "callers need vault:read to resolve me"  (the rule)
kernel            ->  checks the rule against the real caller  (enforcement)
```

## Tiers

Every participant has a **tier**: `kernel`, `core` or `userland`, from most to least trusted. Most participants are `userland`, which is the SDK default. Tiers are an ordering hint used by the access broker. They are not a substitute for policy.

## Participants never import each other

Participants do not import each other's code to call it. They resolve exposures by name through the kernel. That is how the kernel can see, check and record every call. Contract and type packages may be imported. Behavior may not.

**Next:** [The manifest](manifest.md)
