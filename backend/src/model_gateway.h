#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace oral_training {

class IModelGateway {
 public:
  using json = nlohmann::json;

  virtual ~IModelGateway() = default;

  virtual bool configured() const = 0;
  virtual std::string modelVersion() const = 0;
  virtual void setRuntimeKey(const std::string& api_key) = 0;
  virtual json patientReply(const json& scenario, const json& patient_state,
                            const json& history) const = 0;
  virtual json evaluate(const json& scenario, const json& messages) const = 0;
  virtual json standardServiceReply(const json& scenario, const json& history) const = 0;
  virtual json groundedServiceReply(const json& scenario, const json& history,
                                    const json& evidence) const {
    return standardServiceReply(scenario, history);
  }
  virtual json roleplaySummary(const json& scenario, const json& history) const = 0;
  virtual json generateKnowledgeDraft(const std::string& kind,
                                      const json& input) const {
    return json::object();
  }
};

}  // namespace oral_training
