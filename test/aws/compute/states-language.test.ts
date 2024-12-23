import { Testing } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { render } from "./private/render-util";
import { iam, compute, AwsStack } from "../../../src/aws";
import { Duration } from "../../../src/duration";

const gridUUID = "123e4567-e89b-12d3";
describe("States Language", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app, `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });

  test("A single task is a State Machine", () => {
    // WHEN
    const chain = new compute.Pass(stack, "Some State");

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Some State",
      States: {
        "Some State": { Type: "Pass", End: true },
      },
    });
  });

  test("A sequence of two tasks is a State Machine", () => {
    // WHEN
    const task1 = new compute.Pass(stack, "State One");
    const task2 = new compute.Pass(stack, "State Two");

    const chain = compute.Chain.start(task1).next(task2);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "State One",
      States: {
        "State One": { Type: "Pass", Next: "State Two" },
        "State Two": { Type: "Pass", End: true },
      },
    });
  });

  test("You dont need to hold on to the state to render the entire state machine correctly", () => {
    // WHEN
    const task1 = new compute.Pass(stack, "State One");
    const task2 = new compute.Pass(stack, "State Two");

    task1.next(task2);

    // THEN
    expect(render(stack, task1)).toStrictEqual({
      StartAt: "State One",
      States: {
        "State One": { Type: "Pass", Next: "State Two" },
        "State Two": { Type: "Pass", End: true },
      },
    });
  });

  test("A chain can be appended to", () => {
    // GIVEN
    const task1 = new compute.Pass(stack, "State One");
    const task2 = new compute.Pass(stack, "State Two");
    const task3 = new compute.Pass(stack, "State Three");

    // WHEN
    const chain = compute.Chain.start(task1).next(task2).next(task3);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "State One",
      States: {
        "State One": { Type: "Pass", Next: "State Two" },
        "State Two": { Type: "Pass", Next: "State Three" },
        "State Three": { Type: "Pass", End: true },
      },
    });
  });

  test("A state machine can be appended to another state machine", () => {
    // GIVEN
    const task1 = new compute.Pass(stack, "State One");
    const task2 = new compute.Pass(stack, "State Two");
    const task3 = new compute.Wait(stack, "State Three", {
      time: compute.WaitTime.duration(Duration.seconds(10)),
    });

    // WHEN
    const chain = compute.Chain.start(task1).next(
      compute.Chain.start(task2).next(task3),
    );

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "State One",
      States: {
        "State One": { Type: "Pass", Next: "State Two" },
        "State Two": { Type: "Pass", Next: "State Three" },
        "State Three": { Type: "Wait", End: true, Seconds: 10 },
      },
    });
  });

  test("A state machine definition can be instantiated and chained", () => {
    const before = new compute.Pass(stack, "Before");
    const after = new compute.Pass(stack, "After");

    // WHEN
    const chain = before
      .next(new ReusableStateMachine(stack, "Reusable"))
      .next(after);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Before",
      States: {
        Before: { Type: "Pass", Next: "Choice" },
        Choice: {
          Type: "Choice",
          Choices: [
            {
              Variable: "$.branch",
              StringEquals: "left",
              Next: "Left Branch",
            },
            {
              Variable: "$.branch",
              StringEquals: "right",
              Next: "Right Branch",
            },
          ],
        },
        "Left Branch": { Type: "Pass", Next: "After" },
        "Right Branch": { Type: "Pass", Next: "After" },
        After: { Type: "Pass", End: true },
      },
    });
  });

  test("A success state cannot be chained onto", () => {
    // GIVEN

    const succeed = new compute.Succeed(stack, "Succeed");
    const pass = new compute.Pass(stack, "Pass");

    // WHEN
    expect(() => pass.next(succeed).next(pass)).toThrow();
  });

  test("A failure state cannot be chained onto", () => {
    // GIVEN
    const fail = new compute.Fail(stack, "Fail", {
      error: "X",
      cause: "Y",
    });
    const pass = new compute.Pass(stack, "Pass");

    // WHEN
    expect(() => pass.next(fail).next(pass)).toThrow();
  });

  test("Parallels can contain direct states", () => {
    // GIVEN
    const one = new compute.Pass(stack, "One");
    const two = new compute.Pass(stack, "Two");
    const three = new compute.Pass(stack, "Three");

    // WHEN
    const para = new compute.Parallel(stack, "Parallel");
    para.branch(one.next(two));
    para.branch(three);

    // THEN
    expect(render(stack, para)).toStrictEqual({
      StartAt: "Parallel",
      States: {
        Parallel: {
          Type: "Parallel",
          End: true,
          Branches: [
            {
              StartAt: "One",
              States: {
                One: { Type: "Pass", Next: "Two" },
                Two: { Type: "Pass", End: true },
              },
            },
            {
              StartAt: "Three",
              States: {
                Three: { Type: "Pass", End: true },
              },
            },
          ],
        },
      },
    });
  });

  test("Parallels can contain instantiated reusable definitions", () => {
    // WHEN
    const para = new compute.Parallel(stack, "Parallel");
    para.branch(
      new ReusableStateMachine(stack, "Reusable1").prefixStates("Reusable1/"),
    );
    para.branch(
      new ReusableStateMachine(stack, "Reusable2").prefixStates("Reusable2/"),
    );

    // THEN
    expect(render(stack, para)).toStrictEqual({
      StartAt: "Parallel",
      States: {
        Parallel: {
          Type: "Parallel",
          End: true,
          Branches: [
            {
              StartAt: "Reusable1/Choice",
              States: {
                "Reusable1/Choice": {
                  Type: "Choice",
                  Choices: [
                    {
                      Variable: "$.branch",
                      StringEquals: "left",
                      Next: "Reusable1/Left Branch",
                    },
                    {
                      Variable: "$.branch",
                      StringEquals: "right",
                      Next: "Reusable1/Right Branch",
                    },
                  ],
                },
                "Reusable1/Left Branch": { Type: "Pass", End: true },
                "Reusable1/Right Branch": { Type: "Pass", End: true },
              },
            },
            {
              StartAt: "Reusable2/Choice",
              States: {
                "Reusable2/Choice": {
                  Type: "Choice",
                  Choices: [
                    {
                      Variable: "$.branch",
                      StringEquals: "left",
                      Next: "Reusable2/Left Branch",
                    },
                    {
                      Variable: "$.branch",
                      StringEquals: "right",
                      Next: "Reusable2/Right Branch",
                    },
                  ],
                },
                "Reusable2/Left Branch": { Type: "Pass", End: true },
                "Reusable2/Right Branch": { Type: "Pass", End: true },
              },
            },
          ],
        },
      },
    });
  });

  test("State Machine Fragments can be wrapped in a single state", () => {
    const reusable = new SimpleChain(stack, "Hello");
    const state = reusable.toSingleState();

    expect(render(stack, state)).toStrictEqual({
      StartAt: "Hello",
      States: {
        Hello: {
          Type: "Parallel",
          End: true,
          Branches: [
            {
              StartAt: "Hello: Task1",
              States: {
                "Hello: Task1": {
                  Type: "Task",
                  Next: "Hello: Task2",
                  Resource: "resource",
                },
                "Hello: Task2": {
                  Type: "Task",
                  End: true,
                  Resource: "resource",
                },
              },
            },
          ],
        },
      },
    });
  });

  test("Chaining onto branched failure state ignores failure state", () => {
    const yes = new compute.Pass(stack, "Yes");
    const no = new compute.Fail(stack, "No", {
      error: "Failure",
      cause: "Wrong branch",
    });
    const enfin = new compute.Pass(stack, "Finally");
    const choice = new compute.Choice(stack, "Choice")
      .when(compute.Condition.stringEquals("$.foo", "bar"), yes)
      .otherwise(no);

    // WHEN
    choice.afterwards().next(enfin);

    // THEN
    expect(render(stack, choice)).toStrictEqual({
      StartAt: "Choice",
      States: {
        Choice: {
          Type: "Choice",
          Choices: [{ Variable: "$.foo", StringEquals: "bar", Next: "Yes" }],
          Default: "No",
        },
        Yes: { Type: "Pass", Next: "Finally" },
        No: { Type: "Fail", Error: "Failure", Cause: "Wrong branch" },
        Finally: { Type: "Pass", End: true },
      },
    });
  });

  test("Can include OTHERWISE transition for Choice in afterwards()", () => {
    // WHEN
    const chain = new compute.Choice(stack, "Choice")
      .when(
        compute.Condition.stringEquals("$.foo", "bar"),
        new compute.Pass(stack, "Yes"),
      )
      .afterwards({ includeOtherwise: true })
      .next(new compute.Pass(stack, "Finally"));

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Choice",
      States: {
        Choice: {
          Type: "Choice",
          Choices: [{ Variable: "$.foo", StringEquals: "bar", Next: "Yes" }],
          Default: "Finally",
        },
        Yes: { Type: "Pass", Next: "Finally" },
        Finally: { Type: "Pass", End: true },
      },
    });
  });

  test("State machines can have unconstrainted gotos", () => {
    const one = new compute.Pass(stack, "One");
    const two = new compute.Pass(stack, "Two");

    // WHEN
    const chain = one.next(two).next(one);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "One",
      States: {
        One: { Type: "Pass", Next: "Two" },
        Two: { Type: "Pass", Next: "One" },
      },
    });
  });

  test("States can have error branches", () => {
    // GIVEN
    const task1 = new FakeTask(stack, "Task1");
    const failure = new compute.Fail(stack, "Failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });

    // WHEN
    const chain = task1.addCatch(failure);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Task1",
      States: {
        Task1: {
          Type: "Task",
          Resource: "resource",
          End: true,
          Catch: [{ ErrorEquals: ["States.ALL"], Next: "Failed" }],
        },
        Failed: {
          Type: "Fail",
          Error: "DidNotWork",
          Cause: "We got stuck",
        },
      },
    });
  });

  test("Retries and errors with a result path", () => {
    // GIVEN
    const task1 = new FakeTask(stack, "Task1");
    const failure = new compute.Fail(stack, "Failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });

    // WHEN
    const chain = task1
      .addRetry({ errors: ["HTTPError"], maxAttempts: 2 })
      .addCatch(failure, { resultPath: "$.some_error" })
      .next(failure);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Task1",
      States: {
        Task1: {
          Type: "Task",
          Resource: "resource",
          Catch: [
            {
              ErrorEquals: ["States.ALL"],
              Next: "Failed",
              ResultPath: "$.some_error",
            },
          ],
          Retry: [{ ErrorEquals: ["HTTPError"], MaxAttempts: 2 }],
          Next: "Failed",
        },
        Failed: {
          Type: "Fail",
          Error: "DidNotWork",
          Cause: "We got stuck",
        },
      },
    });
  });

  test("Can wrap chain and attach error handler", () => {
    // GIVEN
    const task1 = new FakeTask(stack, "Task1");
    const task2 = new FakeTask(stack, "Task2");
    const errorHandler = new compute.Pass(stack, "ErrorHandler");

    // WHEN
    const chain = task1
      .next(task2)
      .toSingleState("Wrapped")
      .addCatch(errorHandler);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Wrapped",
      States: {
        Wrapped: {
          Type: "Parallel",
          Branches: [
            {
              StartAt: "Task1",
              States: {
                Task1: {
                  Type: "Task",
                  Resource: "resource",
                  Next: "Task2",
                },
                Task2: {
                  Type: "Task",
                  Resource: "resource",
                  End: true,
                },
              },
            },
          ],
          Catch: [{ ErrorEquals: ["States.ALL"], Next: "ErrorHandler" }],
          End: true,
        },
        ErrorHandler: { Type: "Pass", End: true },
      },
    });
  });

  test("Chaining does not chain onto error handler state", () => {
    const task1 = new FakeTask(stack, "Task1");
    const task2 = new FakeTask(stack, "Task2");
    const errorHandler = new compute.Pass(stack, "ErrorHandler");

    // WHEN
    const chain = task1.addCatch(errorHandler).next(task2);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Task1",
      States: {
        Task1: {
          Type: "Task",
          Resource: "resource",
          Next: "Task2",
          Catch: [{ ErrorEquals: ["States.ALL"], Next: "ErrorHandler" }],
        },
        Task2: { Type: "Task", Resource: "resource", End: true },
        ErrorHandler: { Type: "Pass", End: true },
      },
    });
  });

  test("Chaining does not chain onto error handler, extended", () => {
    // GIVEN
    const task1 = new FakeTask(stack, "Task1");
    const task2 = new FakeTask(stack, "Task2");
    const task3 = new FakeTask(stack, "Task3");
    const errorHandler = new compute.Pass(stack, "ErrorHandler");

    // WHEN
    const chain = task1
      .addCatch(errorHandler)
      .next(task2.addCatch(errorHandler))
      .next(task3.addCatch(errorHandler));

    // THEN
    const sharedTaskProps = {
      Type: "Task",
      Resource: "resource",
      Catch: [{ ErrorEquals: ["States.ALL"], Next: "ErrorHandler" }],
    };
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Task1",
      States: {
        Task1: { Next: "Task2", ...sharedTaskProps },
        Task2: { Next: "Task3", ...sharedTaskProps },
        Task3: { End: true, ...sharedTaskProps },
        ErrorHandler: { Type: "Pass", End: true },
      },
    });
  });

  test("Error handler with a fragment", () => {
    const task1 = new FakeTask(stack, "Task1");
    const task2 = new FakeTask(stack, "Task2");
    const errorHandler = new compute.Pass(stack, "ErrorHandler");

    // WHEN
    task1
      .addCatch(errorHandler)
      .next(new SimpleChain(stack, "Chain").catch(errorHandler))
      .next(task2.addCatch(errorHandler));
  });

  test("Can merge state machines with shared states", () => {
    // GIVEN
    const task1 = new FakeTask(stack, "Task1");
    const task2 = new FakeTask(stack, "Task2");
    const failure = new compute.Fail(stack, "Failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });

    // WHEN
    task1.addCatch(failure);
    task2.addCatch(failure);

    task1.next(task2);

    // THEN
    expect(render(stack, task1)).toStrictEqual({
      StartAt: "Task1",
      States: {
        Task1: {
          Type: "Task",
          Resource: "resource",
          Next: "Task2",
          Catch: [{ ErrorEquals: ["States.ALL"], Next: "Failed" }],
        },
        Task2: {
          Type: "Task",
          Resource: "resource",
          End: true,
          Catch: [{ ErrorEquals: ["States.ALL"], Next: "Failed" }],
        },
        Failed: {
          Type: "Fail",
          Error: "DidNotWork",
          Cause: "We got stuck",
        },
      },
    });
  });

  test("No duplicate state IDs", () => {
    // GIVEN
    const intermediateParent = new Construct(stack, "Parent");

    const state1 = new compute.Pass(stack, "State");
    const state2 = new compute.Pass(intermediateParent, "State");

    state1.next(state2);

    // WHEN
    expect(() => render(stack, state1)).toThrow();
  });

  test("No duplicate state IDs even across Parallel branches", () => {
    // GIVEN
    const intermediateParent = new Construct(stack, "Parent");

    const state1 = new compute.Pass(stack, "State");
    const state2 = new compute.Pass(intermediateParent, "State");

    const parallel = new compute.Parallel(stack, "Parallel")
      .branch(state1)
      .branch(state2);

    // WHEN
    expect(() => render(stack, parallel)).toThrow();
  });

  test("No cross-parallel jumps", () => {
    // GIVEN
    const state1 = new compute.Pass(stack, "State1");
    const state2 = new compute.Pass(stack, "State2");

    const parallel = new compute.Parallel(stack, "Parallel")
      .branch(state1.next(state2))
      .branch(state2);

    // WHEN
    expect(() => render(stack, parallel)).toThrow();
  });

  describe("findReachableStates", () => {
    test("Can retrieve possible states from initial state", () => {
      // GIVEN
      const state1 = new compute.Pass(stack, "State1");
      const state2 = new compute.Pass(stack, "State2");
      const state3 = new compute.Pass(stack, "State3");

      const definition = state1.next(state2).next(state3);

      // WHEN
      const states = compute.State.findReachableStates(definition.startState);

      // THEN
      expect(state1.id).toStrictEqual(states[0].id);
      expect(state2.id).toStrictEqual(states[1].id);
      expect(state3.id).toStrictEqual(states[2].id);
    });

    test("Does not retrieve unreachable states", () => {
      // GIVEN
      const state1 = new compute.Pass(stack, "State1");
      const state2 = new compute.Pass(stack, "State2");
      const state3 = new compute.Pass(stack, "State3");

      state1.next(state2).next(state3);

      // WHEN
      const states = compute.State.findReachableStates(state2);

      // THEN
      expect(state2.id).toStrictEqual(states[0].id);
      expect(state3.id).toStrictEqual(states[1].id);
      expect(states.length).toStrictEqual(2);
    });

    test("Works with Choice and Parallel states", () => {
      // GIVEN
      const state1 = new compute.Choice(stack, "MainChoice");
      const stateCA = new compute.Pass(stack, "StateA");
      const stateCB = new compute.Pass(stack, "StateB");
      const statePA = new compute.Pass(stack, "ParallelA");
      const statePB = new compute.Pass(stack, "ParallelB");
      const state2 = new compute.Parallel(stack, "RunParallel");
      const state3 = new compute.Pass(stack, "FinalState");
      state2.branch(statePA);
      state2.branch(statePB);
      state1.when(compute.Condition.stringEquals("$.myInput", "A"), stateCA);
      state1.when(compute.Condition.stringEquals("$.myInput", "B"), stateCB);
      stateCA.next(state2);
      state2.next(state3);

      const definition = state1.otherwise(stateCA);

      // WHEN
      const statesFromStateCB = compute.State.findReachableStates(stateCB);
      const statesFromState1 = compute.State.findReachableStates(definition);

      // THEN
      const expectedFromState1 = [state1, stateCA, stateCB, state2, state3];
      for (let i = 0; i < expectedFromState1.length; i++) {
        expect(statesFromState1[i].id).toStrictEqual(expectedFromState1[i].id);
      }
      expect(statesFromStateCB[0].id).toStrictEqual(stateCB.id);
    });
  });
});

class ReusableStateMachine extends compute.StateMachineFragment {
  public readonly startState: compute.State;
  public readonly endStates: compute.INextable[];
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const choice = new compute.Choice(this, "Choice")
      .when(
        compute.Condition.stringEquals("$.branch", "left"),
        new compute.Pass(this, "Left Branch"),
      )
      .when(
        compute.Condition.stringEquals("$.branch", "right"),
        new compute.Pass(this, "Right Branch"),
      );

    this.startState = choice;
    this.endStates = choice.afterwards().endStates;
  }
}

class SimpleChain extends compute.StateMachineFragment {
  public readonly startState: compute.State;
  public readonly endStates: compute.INextable[];

  private readonly task2: compute.TaskStateBase;
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const task1 = new FakeTask(this, "Task1");
    this.task2 = new FakeTask(this, "Task2");

    task1.next(this.task2);

    this.startState = task1;
    this.endStates = [this.task2];
  }

  public catch(
    state: compute.IChainable,
    props?: compute.CatchProps,
  ): SimpleChain {
    this.task2.addCatch(state, props);
    return this;
  }
}

// function render(sm: compute.IChainable) {
//   return new cdk.Stack().resolve(
//     new compute.StateGraph(sm.startState, "Test Graph").toGraphJson(),
//   );
// }

interface FakeTaskProps extends compute.TaskStateBaseProps {
  readonly policies?: iam.PolicyStatement[];
}

class FakeTask extends compute.TaskStateBase {
  // protected readonly taskMetrics?: compute.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  constructor(scope: Construct, id: string, props: FakeTaskProps = {}) {
    super(scope, id, props);
    this.taskPolicies = props.policies;
  }

  protected _renderTask(): any {
    return {
      Resource: "resource",
    };
  }
}
