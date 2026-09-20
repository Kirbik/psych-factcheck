export type AuthActionState = {
  message?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
    passwordRepeat?: string[];
  };
};

export const initialAuthActionState: AuthActionState = {};
