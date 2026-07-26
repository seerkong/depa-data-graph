# MVI flow with state-node facades

The current unidirectional flow is named node operations, not a global intent object:

```text
View event -> node.mutations / node.actions -> DataGraph transition -> Signal read or Stream subscription -> View
```

Views read current state with a Signal ref and subscribe to transition/event feeds with a Stream ref. A simple UI event calls a typed mutation; an effectful workflow calls a typed action.

```ts
button.addEventListener('click', () => counterNode.mutations.increment(1));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await searchNode.actions.refresh();
});
```

Mutations are synchronous named state transitions. Actions receive `rt`, may call `rt.bizRuntime`, and change state only with `rt.mutations`. This preserves one inspectable state-change boundary without exposing a public setter.

`dispatch` is the public lower-level named-operation pipeline shared by the
facades: `node.dispatch(node.operations.mutations.increment(1))`. It accepts
the closed typed union, not a raw next state or updater. Cross-view coordination
is expressed through shared typed refs and explicit graph edges, not an active
actor mesh. A view reads `handle.output`; it never sets a state-node output.
