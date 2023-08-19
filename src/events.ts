import { flatMap } from "lodash";

export interface IEventData<T = any> {
  name: string;
  data: T;
}

export type IEventFilter = (event: IEventData) => boolean;
export type IEventHandler<T = any> = (eventData: IEventData<T>) => boolean | void | Promise<boolean> | Promise<void>;

export interface ISubscription {
  filter: IEventFilter;
  handler: IEventHandler;
}

export interface ISubscriptionResult {
  unsubscribe: () => boolean;
}

const subscriptions: ISubscription[] = [];

export function subscribe<T = any>(
  nameOrFilter: string | IEventFilter,
  handler: IEventHandler<T>
): ISubscriptionResult {
  if (typeof nameOrFilter === "string") {
    const name = nameOrFilter;
    nameOrFilter = (evt) => evt.name === name;
  }
  const filter = nameOrFilter;
  const subscription: ISubscription = {
    filter,
    handler,
  };
  subscriptions.push(subscription);
  return {
    unsubscribe: () => {
      const iSub = subscriptions.indexOf(subscription);
      if (iSub >= 0) {
        subscriptions.splice(iSub, 1);
        return true;
      }
      return false;
    },
  };
}

export function subscribeDebounce<T = any>(
  nameOrFilter: string | IEventFilter,
  handler: IEventHandler<T>,
  debounceMs: number
): ISubscriptionResult {
  let pid: any;
  const handlerDebounced: IEventHandler = (evt) => {
    if (pid) {
      clearTimeout(pid);
    }
    pid = setTimeout(() => {
      pid = 0;
      handler(evt);
    }, debounceMs);
  };
  return subscribe(nameOrFilter, handlerDebounced);
}

export async function emit(event: IEventData): Promise<boolean> {
  const matchedHandlerPromises = subscriptions
    .filter((subscription) => subscription.filter(event))
    .map(async (subscription) => {
      try {
        return await subscription.handler(event);
      } catch (err) {
        console.error(
          `An unhandled error occurred in a handler while processing event: ${JSON.stringify({ event, subscription })}`
        );
        return false;
      }
    });
  const results = await Promise.all(matchedHandlerPromises);
  // if any handlers returned false (or errored), return false, otherwise return true
  return !results.some((r) => r === false);
}

// TODO probably comment this out or put behind a debug flag
// subscribe to all events and log them out
// subscribe(
//   () => true,
//   (evt) => {
//     console.log(`event published: ${evt.name}`, { eventName: evt.name, data: evt.data });
//   }
// );

export type IHandler<T> = (data: T) => boolean | void | Promise<boolean> | Promise<void>;

export interface IEvent<T> {
  eventName: () => string;
  subscribe: (handler: IHandler<T>) => ISubscriptionResult;
  next: () => Promise<T>;
  union: <U>(event: IEvent<U>) => IEvent<T | U>;
}

export class Event<T> implements IEvent<T> {
  constructor(readonly _eventName: string) {
    if (_eventName.includes("|")) {
      throw new Error(`Do not use pipes in event names, they are reserved for union events`);
    }
  }

  eventName = () => this._eventName;

  public emit(data: T) {
    return emit({
      name: this._eventName,
      data,
    });
  }

  subscribe = (handler: IHandler<T>, debounceMs?: number) => {
    const rawHandler: IEventHandler<T> = (evt: IEventData<T>) => handler(evt.data);
    if (typeof debounceMs !== "number") {
      return subscribe(this._eventName, rawHandler);
    } else {
      return subscribeDebounce(this._eventName, rawHandler, debounceMs);
    }
  };

  next: () => Promise<T> = () =>
    new Promise((resolve) => {
      const sub = this.subscribe((evt) => {
        sub.unsubscribe();
        resolve(evt);
      });
    });

  union: <U>(event: IEvent<U>) => IEvent<T | U> = (event) => unionEvents(this, event);
}

export function unionEvents(...events: IEvent<any>[]): IEvent<any> {
  const eventName = events.map((s) => s.eventName()).join("|");
  return {
    eventName: () => eventName,
    next: () => Promise.race(events.map((s) => s.next())),
    subscribe: (handler) =>
      subscribe(
        (evt) => flatMap(events, (s) => s.eventName().split("|")).includes(evt.name),
        (evt) => handler(evt)
      ),
    union: unionEvents,
  };
}
