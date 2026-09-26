export type AuthActionState = {
  message?: string;
  generatedToken?: string;
  recoveryCode?: string;
  registrationComplete?: boolean;
  fieldErrors?: {
    token?: string[];
  };
};

export const initialAuthActionState: AuthActionState = {};
