/** Plan du jour J d'une course (document v1, miroir de backend/app/race_plan.py). */

export interface Repas {
  heure?: string;
  description: string;
  glucides_g?: number;
}

export interface JourAvant {
  jour: number;
  titre?: string;
  activite?: string;
  repas?: Repas[];
  hydratation?: string;
  sommeil?: string;
  notes?: string[];
}

export interface Matin {
  reveil?: string;
  depart?: string;
  repas?: Repas[];
  echauffement?: string;
  hydratation?: string;
  notes?: string[];
}

export interface Tranche {
  debut_min: number;
  fin_min: number;
  km_debut?: number;
  km_fin?: number;
  zone?: string;
  fc_min?: number;
  fc_max?: number;
  allure?: string;
  glucides_g?: number;
  gels?: number;
  boisson_ml?: number;
  sodium_mg?: number;
  aliment?: string;
  note?: string;
}

export interface Ravitaillement {
  km: number;
  nom?: string;
  temps_estime_min?: number;
  action?: string;
}

export interface RacePlanDoc {
  version: 1;
  course?: string;
  objectif?: { temps_cible_min?: number; allure_cible?: string; strategie?: string };
  jours_avant?: JourAvant[];
  matin?: Matin;
  tranches?: Tranche[];
  ravitaillements?: Ravitaillement[];
  materiel?: string[];
  apres_course?: { repas?: Repas[]; notes?: string[] };
  notes?: string[];
}
