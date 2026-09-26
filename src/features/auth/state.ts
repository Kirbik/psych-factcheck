export type AuthActionState = {
  message?: string;
  generatedToken?: string;
  registrationComplete?: boolean;
  fieldErrors?: {
    secretWord?: string[];
    token?: string[];
  };
};

export const initialAuthActionState: AuthActionState = {};
