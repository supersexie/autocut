import { PlanPicker } from '../components/PlanPicker';

/** Last step of setup: pick a plan, then the setup answers are saved to the account. */
export default function Paywall() {
  return <PlanPicker mode="onboarding" />;
}
