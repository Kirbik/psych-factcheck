export type AuthActionState = {
  message?: string;
  generatedToken?: string;
  fieldErrors?: {
    secretWord?: string[];
    token?: string[];
  };
};

export const initialAuthActionState: AuthActionState = {};
